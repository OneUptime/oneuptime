import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import React, { FunctionComponent, ReactElement } from "react";
import AppLink from "../AppLink/AppLink";

export interface ComponentProps {
  kubernetesCluster: KubernetesCluster;
  onNavigateComplete?: (() => void) | undefined;
  showIcon?: boolean | undefined;
}

const KubernetesClusterElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.kubernetesCluster?._id) {
    return (
      <AppLink
        className="hover:underline"
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW] as Route,
          {
            modelId: new ObjectID(props.kubernetesCluster._id as string),
          },
        )}
        onNavigateComplete={props.onNavigateComplete}
      >
        <span className="flex">
          {props.showIcon ? (
            <Icon icon={IconProp.Kubernetes} className="w-5 h-5 mr-1" />
          ) : (
            <></>
          )}{" "}
          {props.kubernetesCluster.name}
        </span>
      </AppLink>
    );
  }

  return <span>{props.kubernetesCluster?.name || ""}</span>;
};

export default KubernetesClusterElement;
