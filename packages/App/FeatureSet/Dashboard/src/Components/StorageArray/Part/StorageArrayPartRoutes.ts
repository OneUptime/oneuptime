import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import RecommendationFilterUtil, {
  RECOMMENDATION_SELECTION_QUERY_PARAM,
} from "../../Recommendations/RecommendationFilterUtil";
import { routeParamFromExternalId } from "../../../Pages/StorageArray/Utils/StorageArrayResourceUtils";

/*
 * Where a storage array's pages link to: the array, a volume's, a host's, a
 * file system's and a bucket's own page (a hardware component, a drive, a
 * controller and a network interface have the Hardware list, a pod the
 * Replication list), the incidents, alerts and monitors the cards list,
 * and the array's Recommendations with the alerts to turn on ticked.
 */
export interface StorageArrayPartRoutes {
  arrayRoute: Route;
  hardwareRoute: Route;
  replicationRoute: Route;
  // A part's own page, or the list it is on.
  getPartRoute: (kind: string, externalId: string) => Route;
  getIncidentRoute: (incidentId: ObjectID) => Route;
  getAlertRoute: (alertId: ObjectID) => Route;
  getMonitorRoute: (monitorId: ObjectID) => Route;
  getRecommendationsRoute: (recommendationIds: Array<string>) => Route;
  incidentsRoute: Route;
  alertsRoute: Route;
}

// The parts with a page of their own, by the page.
const PART_PAGES: Record<string, PageMap> = {
  Volume: PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL,
  Host: PageMap.STORAGE_ARRAY_VIEW_HOST_DETAIL,
  FileSystem: PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL,
  Bucket: PageMap.STORAGE_ARRAY_VIEW_BUCKET_DETAIL,
};

// The lists the other parts are on.
const PART_LISTS: Record<string, PageMap> = {
  Hardware: PageMap.STORAGE_ARRAY_VIEW_HARDWARE,
  Drive: PageMap.STORAGE_ARRAY_VIEW_HARDWARE,
  Controller: PageMap.STORAGE_ARRAY_VIEW_HARDWARE,
  NetworkInterface: PageMap.STORAGE_ARRAY_VIEW_HARDWARE,
  Pod: PageMap.STORAGE_ARRAY_VIEW_REPLICATION,
  Directory: PageMap.STORAGE_ARRAY_VIEW_DIRECTORIES,
};

export function getStorageArrayPartRoutes(
  storageArrayId: ObjectID,
): StorageArrayPartRoutes {
  const ofArray: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
      modelId: storageArrayId,
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

  const arrayRoute: Route = ofArray(PageMap.STORAGE_ARRAY_VIEW);

  return {
    arrayRoute: arrayRoute,
    hardwareRoute: ofArray(PageMap.STORAGE_ARRAY_VIEW_HARDWARE),
    replicationRoute: ofArray(PageMap.STORAGE_ARRAY_VIEW_REPLICATION),
    getPartRoute: (kind: string, externalId: string): Route => {
      const page: PageMap | undefined = PART_PAGES[kind];
      if (page) {
        // The part's own name on the array, percent-encoded: one segment.
        return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
          modelId: storageArrayId,
          subModelId: routeParamFromExternalId(externalId),
        });
      }
      const list: PageMap | undefined = PART_LISTS[kind];
      return list ? ofArray(list) : arrayRoute;
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
      return ofArray(PageMap.STORAGE_ARRAY_VIEW_RECOMMENDATIONS).addQueryParams(
        {
          [RECOMMENDATION_SELECTION_QUERY_PARAM]:
            RecommendationFilterUtil.toSelectionQuery(recommendationIds),
        },
      );
    },
    incidentsRoute: ofArray(PageMap.STORAGE_ARRAY_VIEW_INCIDENTS),
    alertsRoute: ofArray(PageMap.STORAGE_ARRAY_VIEW_ALERTS),
  };
}
