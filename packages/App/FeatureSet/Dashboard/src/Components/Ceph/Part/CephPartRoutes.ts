import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import RecommendationFilterUtil, {
  RECOMMENDATION_SELECTION_QUERY_PARAM,
} from "../../Recommendations/RecommendationFilterUtil";
import { CephPartKind } from "../../../Pages/Ceph/Utils/CephHealth";

/*
 * Where a Ceph cluster's pages link to: the cluster, an OSD's and a pool's
 * own page (a monitor, a manager, a metadata server and a gateway have the
 * Daemons list), the lists, the incidents, alerts and monitors the cards
 * list, and the cluster's Recommendations with the alerts to turn on ticked.
 */
export interface CephPartRoutes {
  clusterRoute: Route;
  osdsRoute: Route;
  poolsRoute: Route;
  daemonsRoute: Route;
  // An OSD's or a pool's page; a daemon's row leads to the Daemons list.
  getPartRoute: (kind: CephPartKind, externalId: string) => Route;
  getIncidentRoute: (incidentId: ObjectID) => Route;
  getAlertRoute: (alertId: ObjectID) => Route;
  getMonitorRoute: (monitorId: ObjectID) => Route;
  getRecommendationsRoute: (recommendationIds: Array<string>) => Route;
  incidentsRoute: Route;
  alertsRoute: Route;
}

export function getCephPartRoutes(clusterId: ObjectID): CephPartRoutes {
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

  const daemonsRoute: Route = ofCluster(PageMap.CEPH_CLUSTER_VIEW_DAEMONS);

  return {
    clusterRoute: ofCluster(PageMap.CEPH_CLUSTER_VIEW),
    osdsRoute: ofCluster(PageMap.CEPH_CLUSTER_VIEW_OSDS),
    poolsRoute: ofCluster(PageMap.CEPH_CLUSTER_VIEW_POOLS),
    daemonsRoute: daemonsRoute,
    getPartRoute: (kind: CephPartKind, externalId: string): Route => {
      if (kind === "Osd" || kind === "Pool") {
        /*
         * The route's part is the OSD's ceph_daemon name ("osd.3") or the
         * pool's pool_id ("2"), as the lists have always linked them.
         */
        return RouteUtil.populateRouteParams(
          RouteMap[
            kind === "Osd"
              ? PageMap.CEPH_CLUSTER_VIEW_OSD_DETAIL
              : PageMap.CEPH_CLUSTER_VIEW_POOL_DETAIL
          ] as Route,
          {
            modelId: clusterId,
            subModelId: new ObjectID(externalId),
          },
        );
      }
      return daemonsRoute;
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
        PageMap.CEPH_CLUSTER_VIEW_RECOMMENDATIONS,
      ).addQueryParams({
        [RECOMMENDATION_SELECTION_QUERY_PARAM]:
          RecommendationFilterUtil.toSelectionQuery(recommendationIds),
      });
    },
    incidentsRoute: ofCluster(PageMap.CEPH_CLUSTER_VIEW_INCIDENTS),
    alertsRoute: ofCluster(PageMap.CEPH_CLUSTER_VIEW_ALERTS),
  };
}
