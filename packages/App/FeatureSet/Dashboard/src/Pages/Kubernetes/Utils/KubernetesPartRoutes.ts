import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import RecommendationFilterUtil, {
  RECOMMENDATION_SELECTION_QUERY_PARAM,
} from "../../../Components/Recommendations/RecommendationFilterUtil";
import { NAMESPACED_KUBERNETES_KINDS } from "./KubernetesAttention";

/*
 * Where a Kubernetes object's page is: one place for every link to one -
 * Needs attention, a workload's pods, the lists, the topology, an Event.
 *
 * Names repeat across namespaces (a `checkout` Deployment in `shop` and in
 * `payments`), and a page's address carries only the name, so a link to a
 * namespaced object says which with `?namespace=`; every such page reads it
 * (getKubernetesNamespaceParam) to find the object, scope its metrics, its
 * events and its logs.
 */

export const KUBERNETES_NAMESPACE_QUERY_PARAM: string = "namespace";

// The namespace the page's address names, if it names one.
export function getKubernetesNamespaceParam(): string | undefined {
  return (
    Navigation.getQueryStringByName(KUBERNETES_NAMESPACE_QUERY_PARAM) ||
    undefined
  );
}

// The kinds OneUptime has a page for, and the page.
export const KUBERNETES_PART_PAGES: Record<string, PageMap> = {
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
  HorizontalPodAutoscaler: PageMap.KUBERNETES_CLUSTER_VIEW_HPA_DETAIL,
  VerticalPodAutoscaler: PageMap.KUBERNETES_CLUSTER_VIEW_VPA_DETAIL,
  DeploymentConfig: PageMap.KUBERNETES_CLUSTER_VIEW_DEPLOYMENTCONFIG_DETAIL,
  Route: PageMap.KUBERNETES_CLUSTER_VIEW_ROUTE_DETAIL,
  Service: PageMap.KUBERNETES_CLUSTER_VIEW_SERVICE_DETAIL,
};

export function getKubernetesPartRoute(
  clusterId: ObjectID,
  part: { kind: string; name: string; namespace?: string | undefined },
): Route | undefined {
  const page: PageMap | undefined = KUBERNETES_PART_PAGES[part.kind];

  if (!page || !part.name) {
    return undefined;
  }

  const route: Route = RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: clusterId,
    subModelId: new ObjectID(part.name),
  });

  return part.namespace && NAMESPACED_KUBERNETES_KINDS.has(part.kind)
    ? route.addQueryParams({
        [KUBERNETES_NAMESPACE_QUERY_PARAM]: part.namespace,
      })
    : route;
}

/*
 * Where a part's page links besides other parts: the cluster, the
 * incidents, alerts and monitors its cards list, and the cluster's
 * Recommendations with the alerts to turn on ticked.
 */
export interface KubernetesPartRoutes {
  clusterRoute: Route;
  getPartRoute: (part: {
    kind: string;
    name: string;
    namespace?: string | undefined;
  }) => Route | undefined;
  getIncidentRoute: (incidentId: ObjectID) => Route;
  getAlertRoute: (alertId: ObjectID) => Route;
  getMonitorRoute: (monitorId: ObjectID) => Route;
  getRecommendationsRoute: (recommendationIds: Array<string>) => Route;
  incidentsRoute: Route;
  alertsRoute: Route;
}

export function getKubernetesPartRoutes(
  clusterId: ObjectID,
): KubernetesPartRoutes {
  const ofCluster: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: clusterId,
    });
  };

  const ofRecord: (page: PageMap, id: ObjectID) => Route = (
    page: PageMap,
    id: ObjectID,
  ): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: id,
    });
  };

  return {
    clusterRoute: ofCluster(PageMap.KUBERNETES_CLUSTER_VIEW),
    getPartRoute: (part: {
      kind: string;
      name: string;
      namespace?: string | undefined;
    }): Route | undefined => {
      return getKubernetesPartRoute(clusterId, part);
    },
    getIncidentRoute: (incidentId: ObjectID): Route => {
      return ofRecord(PageMap.INCIDENT_VIEW, incidentId);
    },
    getAlertRoute: (alertId: ObjectID): Route => {
      return ofRecord(PageMap.ALERT_VIEW, alertId);
    },
    getMonitorRoute: (monitorId: ObjectID): Route => {
      return ofRecord(PageMap.MONITOR_VIEW, monitorId);
    },
    getRecommendationsRoute: (recommendationIds: Array<string>): Route => {
      return ofCluster(
        PageMap.KUBERNETES_CLUSTER_VIEW_RECOMMENDATIONS,
      ).addQueryParams({
        [RECOMMENDATION_SELECTION_QUERY_PARAM]:
          RecommendationFilterUtil.toSelectionQuery(recommendationIds),
      });
    },
    incidentsRoute: ofCluster(PageMap.KUBERNETES_CLUSTER_VIEW_INCIDENTS),
    alertsRoute: ofCluster(PageMap.KUBERNETES_CLUSTER_VIEW_ALERTS),
  };
}
