import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import RecommendationFilterUtil, {
  RECOMMENDATION_SELECTION_QUERY_PARAM,
} from "../../Recommendations/RecommendationFilterUtil";
import { ProxmoxPartKind } from "../../../Pages/Proxmox/Utils/ProxmoxHealth";
import { routeParamFromExternalId } from "../../../Pages/Proxmox/Utils/ProxmoxResourceUtils";

/*
 * Where a Proxmox node's, guest's or storage's page links to: the cluster,
 * the other parts, the incidents, alerts and monitors its cards list, and
 * the cluster's Recommendations with the alerts to turn on ticked.
 */
export interface ProxmoxPartRoutes {
  clusterRoute: Route;
  getPartRoute: (kind: ProxmoxPartKind, externalId: string) => Route;
  getIncidentRoute: (incidentId: ObjectID) => Route;
  getAlertRoute: (alertId: ObjectID) => Route;
  getMonitorRoute: (monitorId: ObjectID) => Route;
  getRecommendationsRoute: (recommendationIds: Array<string>) => Route;
  incidentsRoute: Route;
  alertsRoute: Route;
}

const PART_PAGES: Record<ProxmoxPartKind, PageMap> = {
  Node: PageMap.PROXMOX_CLUSTER_VIEW_NODE_DETAIL,
  Guest: PageMap.PROXMOX_CLUSTER_VIEW_GUEST_DETAIL,
  Storage: PageMap.PROXMOX_CLUSTER_VIEW_STORAGE_DETAIL,
};

export function getProxmoxPartRoutes(clusterId: ObjectID): ProxmoxPartRoutes {
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
    clusterRoute: ofCluster(PageMap.PROXMOX_CLUSTER_VIEW),
    getPartRoute: (kind: ProxmoxPartKind, externalId: string): Route => {
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
        PageMap.PROXMOX_CLUSTER_VIEW_RECOMMENDATIONS,
      ).addQueryParams({
        [RECOMMENDATION_SELECTION_QUERY_PARAM]:
          RecommendationFilterUtil.toSelectionQuery(recommendationIds),
      });
    },
    incidentsRoute: ofCluster(PageMap.PROXMOX_CLUSTER_VIEW_INCIDENTS),
    alertsRoute: ofCluster(PageMap.PROXMOX_CLUSTER_VIEW_ALERTS),
  };
}
