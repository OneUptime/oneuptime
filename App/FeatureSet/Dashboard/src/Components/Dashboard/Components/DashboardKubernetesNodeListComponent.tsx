import React, { FunctionComponent, ReactElement } from "react";
import DashboardKubernetesNodeListComponent from "Common/Types/Dashboard/DashboardComponents/DashboardKubernetesNodeListComponent";
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
import { AttributeToColumnMap } from "Common/Utils/Dashboard/ModelQueryVariableInterpolation";

const ATTRIBUTE_TO_COLUMN: AttributeToColumnMap = {
  "k8s.node.name": "name",
};

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardKubernetesNodeListComponent;
}

const COLUMNS: Array<ResourceListColumn> = [
  { label: "Node", widthPct: "40%" },
  { label: "Status", widthPct: "20%" },
  { label: "Pressure", widthPct: "20%" },
  { label: "Cluster", widthPct: "20%" },
];

function renderNodeRow(r: KubernetesResource): ReactElement {
  const id: string = (r._id as string) || "";
  const name: string = (r.name as string) || "Unnamed";
  const isReady: boolean | undefined = r.isReady as boolean | undefined;
  const clusterName: string = (r.kubernetesCluster?.name as string) || "—";
  const clusterId: string = (r.kubernetesClusterId?.toString() as string) || "";

  let detailLink: ReactElement = <span>{name}</span>;
  if (clusterId && id) {
    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL] as Route,
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

  const readyDot: string =
    isReady === true ? "#10b981" : isReady === false ? "#ef4444" : "#9ca3af";
  const readyText: string =
    isReady === true ? "Ready" : isReady === false ? "Not Ready" : "Unknown";
  const readyTextColor: string =
    isReady === true ? "#047857" : isReady === false ? "#b91c1c" : "#6b7280";

  const pressures: Array<string> = [];
  if (r.hasMemoryPressure) {
    pressures.push("Mem");
  }
  if (r.hasDiskPressure) {
    pressures.push("Disk");
  }
  if (r.hasPidPressure) {
    pressures.push("PID");
  }

  return (
    <tr
      key={id}
      className="hover:bg-gray-50/50 transition-colors duration-100 group"
    >
      <td className="px-3 py-2 text-xs text-gray-700 truncate">{detailLink}</td>
      <td className="px-3 py-2">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ fontSize: "10px" }}
        >
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: readyDot }}
          ></span>
          <span style={{ color: readyTextColor }}>{readyText}</span>
        </span>
      </td>
      <td className="px-3 py-2 text-xs">
        {pressures.length === 0 ? (
          <span className="text-gray-400">—</span>
        ) : (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded font-medium border"
            style={{
              fontSize: "10px",
              color: "#b45309",
              borderColor: "#fcd34d",
              backgroundColor: "#fef3c7",
            }}
          >
            {pressures.join(", ")}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-gray-500 truncate">
        {clusterName}
      </td>
    </tr>
  );
}

const DashboardKubernetesNodeListComponentElement: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  const args: DashboardKubernetesNodeListComponent["arguments"] =
    props.component.arguments;
  const readinessFilter: string | undefined = args.readinessFilter;

  let extraQuery: Record<string, unknown> | undefined = undefined;
  if (readinessFilter === "ready") {
    extraQuery = { isReady: true };
  } else if (readinessFilter === "not-ready") {
    extraQuery = { isReady: false };
  }

  return (
    <DashboardKubernetesResourceListBase
      title={args.title}
      pluralLabel="nodes"
      emptyMessage="No nodes found"
      emptyIcon={IconProp.Server}
      columns={COLUMNS}
      kind="Node"
      maxRows={args.maxRows || 25}
      kubernetesClusterIds={args.kubernetesClusterIds}
      extraQuery={extraQuery}
      refreshTick={props.refreshTick}
      variables={props.variables}
      attributeToColumn={ATTRIBUTE_TO_COLUMN}
      renderRow={renderNodeRow}
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
  DashboardKubernetesNodeListComponentElement,
  arePropsEqual,
);
