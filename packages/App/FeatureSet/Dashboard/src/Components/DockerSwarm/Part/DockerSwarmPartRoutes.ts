import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import RecommendationFilterUtil, {
  RECOMMENDATION_SELECTION_QUERY_PARAM,
} from "../../Recommendations/RecommendationFilterUtil";
import { DockerSwarmPartKind } from "../../../Pages/DockerSwarm/Utils/DockerSwarmHealth";
import { routeParamFromExternalId } from "../../../Pages/DockerSwarm/Utils/DockerSwarmResourceUtils";

/*
 * Where a Docker Swarm node's, service's or task's page links to: the
 * cluster, the other parts, the lists, the incidents, alerts and monitors
 * its cards list, and the cluster's Recommendations with the alerts to turn
 * on ticked.
 */
export interface DockerSwarmPartRoutes {
  clusterRoute: Route;
  nodesRoute: Route;
  servicesRoute: Route;
  tasksRoute: Route;
  getPartRoute: (kind: DockerSwarmPartKind, externalId: string) => Route;
  getIncidentRoute: (incidentId: ObjectID) => Route;
  getAlertRoute: (alertId: ObjectID) => Route;
  getMonitorRoute: (monitorId: ObjectID) => Route;
  getRecommendationsRoute: (recommendationIds: Array<string>) => Route;
  incidentsRoute: Route;
  alertsRoute: Route;
}

const PART_PAGES: Record<DockerSwarmPartKind, PageMap> = {
  Node: PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODE_DETAIL,
  Service: PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICE_DETAIL,
  Task: PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASK_DETAIL,
};

export function getDockerSwarmPartRoutes(
  clusterId: ObjectID,
): DockerSwarmPartRoutes {
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
    clusterRoute: ofCluster(PageMap.DOCKER_SWARM_CLUSTER_VIEW),
    nodesRoute: ofCluster(PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODES),
    servicesRoute: ofCluster(PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICES),
    tasksRoute: ofCluster(PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASKS),
    getPartRoute: (kind: DockerSwarmPartKind, externalId: string): Route => {
      return RouteUtil.populateRouteParams(
        RouteMap[PART_PAGES[kind]] as Route,
        {
          modelId: clusterId,
          subModelId: routeParamFromExternalId(externalId),
        },
      );
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
        PageMap.DOCKER_SWARM_CLUSTER_VIEW_RECOMMENDATIONS,
      ).addQueryParams({
        [RECOMMENDATION_SELECTION_QUERY_PARAM]:
          RecommendationFilterUtil.toSelectionQuery(recommendationIds),
      });
    },
    incidentsRoute: ofCluster(PageMap.DOCKER_SWARM_CLUSTER_VIEW_INCIDENTS),
    alertsRoute: ofCluster(PageMap.DOCKER_SWARM_CLUSTER_VIEW_ALERTS),
  };
}
