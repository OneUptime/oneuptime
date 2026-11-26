import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import RecommendationFilterUtil, {
  RECOMMENDATION_SELECTION_QUERY_PARAM,
} from "../../Recommendations/RecommendationFilterUtil";
import { XcpNgPartKind } from "../../../Pages/XcpNg/Utils/XcpNgHealth";
import { routeParamFromExternalId } from "../../../Pages/XcpNg/Utils/XcpNgResourceUtils";

/*
 * Where an XCP-ng pool's pages link to: the pool, its hosts', VMs' and
 * storage repositories' own pages (by their XAPI UUID), its lists, the
 * incidents, alerts and monitors a part's cards list, and the pool's
 * Recommendations with the alerts to turn on ticked.
 */
export interface XcpNgPartRoutes {
  poolRoute: Route;
  hostsRoute: Route;
  vmsRoute: Route;
  storageRoute: Route;
  getPartRoute: (kind: XcpNgPartKind, externalId: string) => Route;
  getIncidentRoute: (incidentId: ObjectID) => Route;
  getAlertRoute: (alertId: ObjectID) => Route;
  getMonitorRoute: (monitorId: ObjectID) => Route;
  getRecommendationsRoute: (recommendationIds: Array<string>) => Route;
  incidentsRoute: Route;
  alertsRoute: Route;
  scheduledMaintenanceRoute: Route;
  documentationRoute: Route;
  settingsRoute: Route;
}

export const XCP_NG_PART_PAGES: Record<XcpNgPartKind, PageMap> = {
  Host: PageMap.XCP_NG_POOL_VIEW_HOST_DETAIL,
  VM: PageMap.XCP_NG_POOL_VIEW_VM_DETAIL,
  StorageRepository: PageMap.XCP_NG_POOL_VIEW_STORAGE_DETAIL,
};

export function getXcpNgPartRoutes(poolId: ObjectID): XcpNgPartRoutes {
  const ofPool: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: poolId,
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
    poolRoute: ofPool(PageMap.XCP_NG_POOL_VIEW),
    hostsRoute: ofPool(PageMap.XCP_NG_POOL_VIEW_HOSTS),
    vmsRoute: ofPool(PageMap.XCP_NG_POOL_VIEW_VMS),
    storageRoute: ofPool(PageMap.XCP_NG_POOL_VIEW_STORAGE),
    getPartRoute: (kind: XcpNgPartKind, externalId: string): Route => {
      return RouteUtil.populateRouteParams(
        RouteMap[XCP_NG_PART_PAGES[kind]] as Route,
        {
          modelId: poolId,
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
      return ofPool(PageMap.XCP_NG_POOL_VIEW_RECOMMENDATIONS).addQueryParams({
        [RECOMMENDATION_SELECTION_QUERY_PARAM]:
          RecommendationFilterUtil.toSelectionQuery(recommendationIds),
      });
    },
    incidentsRoute: ofPool(PageMap.XCP_NG_POOL_VIEW_INCIDENTS),
    alertsRoute: ofPool(PageMap.XCP_NG_POOL_VIEW_ALERTS),
    scheduledMaintenanceRoute: ofPool(
      PageMap.XCP_NG_POOL_VIEW_SCHEDULED_MAINTENANCE,
    ),
    documentationRoute: ofPool(PageMap.XCP_NG_POOL_VIEW_DOCUMENTATION),
    settingsRoute: ofPool(PageMap.XCP_NG_POOL_VIEW_SETTINGS),
  };
}
