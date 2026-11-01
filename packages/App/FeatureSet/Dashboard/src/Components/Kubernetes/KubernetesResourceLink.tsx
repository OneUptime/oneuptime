import React, { FunctionComponent, ReactElement } from "react";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";

// Maps Kubernetes resource kinds to their detail page PageMap entries
const kindToPageMap: Record<string, PageMap> = {
  Pod: PageMap.KUBERNETES_CLUSTER_VIEW_POD_DETAIL,
  Node: PageMap.KUBERNETES_CLUSTER_VIEW_NODE_DETAIL,
  Namespace: PageMap.KUBERNETES_CLUSTER_VIEW_NAMESPACE_DETAIL,
  Deployment: PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENT_DETAIL,
  StatefulSet: PageMap.KUBERNETES_CLUSTER_VIEW_STATEFULSET_DETAIL,
  DaemonSet: PageMap.KUBERNETES_CLUSTER_VIEW_DAEMONSET_DETAIL,
  Job: PageMap.KUBERNETES_CLUSTER_VIEW_JOB_DETAIL,
  CronJob: PageMap.KUBERNETES_CLUSTER_VIEW_CRONJOB_DETAIL,
  PersistentVolumeClaim: PageMap.KUBERNETES_CLUSTER_VIEW_PVC_DETAIL,
  PersistentVolume: PageMap.KUBERNETES_CLUSTER_VIEW_PV_DETAIL,
  ReplicaSet: PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENT_DETAIL, // ReplicaSets are managed by Deployments
  DeploymentConfig: PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTCONFIG_DETAIL,
  Route: PageMap.KUBERNETES_CLUSTER_VIEW_ROUTE_DETAIL,
  Service: PageMap.KUBERNETES_CLUSTER_VIEW_SERVICE_DETAIL,
};

export interface ComponentProps {
  modelId: ObjectID;
  resourceKind: string;
  resourceName: string;
  // Which one, for a kind whose names repeat across namespaces.
  namespace?: string | undefined;
  className?: string | undefined;
}

const KubernetesResourceLink: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const pageMap: PageMap | undefined = kindToPageMap[props.resourceKind];

  if (!pageMap) {
    // No detail page for this kind — render as plain text
    return <span className={props.className}>{props.resourceName}</span>;
  }

  return (
    <span
      onClick={() => {
        const route: Route = RouteUtil.populateRouteParams(
          RouteMap[pageMap] as Route,
          {
            modelId: props.modelId,
            subModelId: new ObjectID(props.resourceName),
          },
        );

        Navigation.navigate(
          props.namespace
            ? route.addQueryParams({ namespace: props.namespace })
            : route,
        );
      }}
      className={`text-indigo-600 hover:text-indigo-800 cursor-pointer font-medium ${props.className || ""}`}
    >
      {props.resourceName}
    </span>
  );
};

export default KubernetesResourceLink;
