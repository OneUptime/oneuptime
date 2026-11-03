import Route from "Common/Types/API/Route";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import RecommendationFilterUtil, {
  RECOMMENDATION_SELECTION_QUERY_PARAM,
} from "../Recommendations/RecommendationFilterUtil";

/*
 * WHAT TELLS A DOCKER HOST'S PAGES FROM A PODMAN HOST'S.
 *
 * The two products are one product run on two engines: both agents run the
 * collector's docker_stats receiver (Podman through its Docker-compatible
 * socket), both hosts keep the same inventory of containers, and both
 * pages compute the same things the same way. What differs is only this:
 * the runtime value the agent stamps on what it sends, the record the host
 * and its containers are kept in, its pages, its alerts and where its
 * engine keeps container logs.
 */

export type ContainerRuntime = "docker" | "podman";

export interface ContainerHostRuntime {
  // resource.container.runtime on everything the agent sends.
  runtime: ContainerRuntime;
  // The engine's own name, written the same in every language.
  productName: string;
  // The incident's and alert's relation that links them to the host.
  resourceRelation: "dockerHosts" | "podmanHosts";
  recommendationResourceType: MonitorRecommendationResourceType;
  /*
   * The host's alerts that watch each container, in the order a
   * container's page lists them: each is one monitor that fires for any
   * container that crosses it.
   */
  containerAlertTemplateIds: Array<string>;
  // Where the engine writes each container's log, which the agent tails.
  containerLogsDirectory: string;
  pages: {
    host: PageMap;
    containers: PageMap;
    containerDetail: PageMap;
    incidents: PageMap;
    alerts: PageMap;
    recommendations: PageMap;
    documentation: PageMap;
  };
}

export const DOCKER_CONTAINER_HOST_RUNTIME: ContainerHostRuntime = {
  runtime: "docker",
  productName: "Docker",
  resourceRelation: "dockerHosts",
  recommendationResourceType: MonitorRecommendationResourceType.Docker,
  containerAlertTemplateIds: [
    "docker-restart-loop",
    "docker-container-down",
    "docker-high-memory",
    "docker-high-cpu",
    "docker-cpu-throttling",
    "docker-high-pids",
  ],
  containerLogsDirectory: "/var/lib/docker/containers",
  pages: {
    host: PageMap.DOCKER_HOST_VIEW,
    containers: PageMap.DOCKER_HOST_VIEW_CONTAINERS,
    containerDetail: PageMap.DOCKER_HOST_VIEW_CONTAINER_DETAIL,
    incidents: PageMap.DOCKER_HOST_VIEW_INCIDENTS,
    alerts: PageMap.DOCKER_HOST_VIEW_ALERTS,
    recommendations: PageMap.DOCKER_HOST_VIEW_RECOMMENDATIONS,
    documentation: PageMap.DOCKER_HOST_VIEW_DOCUMENTATION,
  },
};

export const PODMAN_CONTAINER_HOST_RUNTIME: ContainerHostRuntime = {
  runtime: "podman",
  productName: "Podman",
  resourceRelation: "podmanHosts",
  recommendationResourceType: MonitorRecommendationResourceType.Podman,
  /*
   * No throttling alert: Podman's agent sends throttling only as a lifetime
   * total, which no alert can tell from a container throttled once long ago
   * (PodmanAlertTemplates).
   */
  containerAlertTemplateIds: [
    "podman-restart-loop",
    "podman-container-down",
    "podman-high-memory",
    "podman-high-cpu",
    "podman-high-pids",
  ],
  containerLogsDirectory: "/var/lib/containers",
  pages: {
    host: PageMap.PODMAN_HOST_VIEW,
    containers: PageMap.PODMAN_HOST_VIEW_CONTAINERS,
    containerDetail: PageMap.PODMAN_HOST_VIEW_CONTAINER_DETAIL,
    incidents: PageMap.PODMAN_HOST_VIEW_INCIDENTS,
    alerts: PageMap.PODMAN_HOST_VIEW_ALERTS,
    recommendations: PageMap.PODMAN_HOST_VIEW_RECOMMENDATIONS,
    documentation: PageMap.PODMAN_HOST_VIEW_DOCUMENTATION,
  },
};

/*
 * Where a container host's pages link to: the host, its containers, the
 * incidents, alerts and monitors a container's cards list, and the host's
 * Recommendations with the alerts to turn on ticked.
 */
export interface ContainerHostRoutes {
  hostRoute: Route;
  containersRoute: Route;
  documentationRoute: Route;
  getContainerRoute: (containerName: string) => Route;
  getIncidentRoute: (incidentId: ObjectID) => Route;
  getAlertRoute: (alertId: ObjectID) => Route;
  getMonitorRoute: (monitorId: ObjectID) => Route;
  getRecommendationsRoute: (recommendationIds: Array<string>) => Route;
  incidentsRoute: Route;
  alertsRoute: Route;
}

export function getContainerHostRoutes(
  runtime: ContainerHostRuntime,
  hostId: ObjectID,
): ContainerHostRoutes {
  const ofHost: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: hostId,
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
    hostRoute: ofHost(runtime.pages.host),
    containersRoute: ofHost(runtime.pages.containers),
    documentationRoute: ofHost(runtime.pages.documentation),
    getContainerRoute: (containerName: string): Route => {
      return RouteUtil.populateRouteParams(
        RouteMap[runtime.pages.containerDetail] as Route,
        { modelId: hostId, subModelId: containerName },
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
      return ofHost(runtime.pages.recommendations).addQueryParams({
        [RECOMMENDATION_SELECTION_QUERY_PARAM]:
          RecommendationFilterUtil.toSelectionQuery(recommendationIds),
      });
    },
    incidentsRoute: ofHost(runtime.pages.incidents),
    alertsRoute: ofHost(runtime.pages.alerts),
  };
}
